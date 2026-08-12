/**
 * 审查表视图（模态全屏，UI-DESIGN.md §6.3）——
 * 左 40% 原图 / 右 60% 审查表；AI 格子双通道编码：琥珀浅底 + 斜纹 + 角标。
 * 识别成功才扣次（失败不扣，422 提示重拍）。
 */
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App as AntApp, Button, Input, InputNumber, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  CameraOutlined,
  CheckCircleOutlined,
  CloseOutlined,
  EditOutlined,
  ScanOutlined,
} from '@ant-design/icons'
import { useReviewStore } from '../features/recognition/reviewStore'
import { useAuthStore } from '../features/licensing/authStore'
import { useProjectStore } from '../features/projects/projectStore'
import { getApiClient, ApiError } from '../infra/api'
import { platform } from '../infra/platform'
import type { ReviewRow } from '../domain/types'
import { qty } from '../domain/types'

const api = getApiClient()

function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

/** 图片字节内容哈希（SHA-256 hex）——服务端按 (user_id, image_hash) 幂等去重，必须用真实内容哈希而非时间戳 */
export async function hashImage(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function ReviewModal() {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const s = useReviewStore()
  const auth = useAuthStore((st) => st.status)
  const updateParts = useProjectStore((st) => st.updateParts)
  const current = useProjectStore((st) => st.current)
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  if (!s.isOpen) return null

  const pickFile = async (file?: File | null) => {
    if (!file) return
    const dataUrl = await readImageFile(file)
    s.setImage(dataUrl)
    s.setRows([])
    s.setError(null)
  }

  const onRecognize = async () => {
    if (!s.image) return
    if (auth.state !== 'loggedIn') {
      s.requireLogin()
      return
    }
    s.setRecognizing(true)
    s.setError(null)
    try {
      const blob = await (await fetch(s.image)).blob()
      const imageHash = await hashImage(blob)
      const sheet = await api.recognize(
        auth.token,
        platform.getDeviceFingerprint(),
        blob,
        imageHash,
      )
      s.acceptSheet(sheet)
      // 成功扣次后刷新余额
      void useAuthStore.getState().refresh()
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === '401') {
          s.setError(t('errors.UNAUTHORIZED'))
          void useAuthStore.getState().load()
        } else if (e.code === '402') {
          s.setError(t('errors.INSUFFICIENT_CREDITS'))
        } else {
          s.setError(t('errors.RECOGNITION_FAILED'))
        }
      } else {
        s.setError(t('errors.NETWORK'))
      }
    } finally {
      s.setRecognizing(false)
    }
  }

  const onImport = () => {
    const valid = s.rows.filter((r) => r.name.trim() && r.length > 0 && r.width > 0 && r.quantity > 0)
    if (valid.length === 0) {
      message.warning(t('review.empty'))
      return
    }
    const existing = current?.parts ?? []
    const base = Date.now()
    const newParts = valid.map((r, i) => ({
      id: `rec-${base}-${i}`,
      name: r.name.trim(),
      length: Math.round(r.length),
      width: Math.round(r.width),
      quantity: qty(Math.max(1, r.quantity)),
    }))
    updateParts([...existing, ...newParts])
    message.success(t('review.imported', { count: valid.length }))
    s.close()
  }

  const columns: ColumnsType<ReviewRow> = [
    {
      title: t('leftPanel.name'),
      dataIndex: 'name',
      render: (v: string, r, i) => (
        <div style={{ position: 'relative' }} className={r.confirmed ? undefined : 'ai-cell'}>
          {!r.confirmed && <span className="ai-badge">AI</span>}
          <Input
            size="small"
            variant="borderless"
            value={v}
            onChange={(e) => s.patchRow(i, { name: e.target.value })}
          />
        </div>
      ),
    },
    {
      title: t('leftPanel.length'),
      dataIndex: 'length',
      width: 90,
      render: (v: number, r, i) => (
        <div className={r.confirmed ? undefined : 'ai-cell'} style={{ borderRadius: 6, padding: 2 }}>
          <InputNumber
            size="small"
            variant="borderless"
            min={1}
            value={v}
            style={{ width: '100%' }}
            onChange={(x) => s.patchRow(i, { length: x ?? 0 })}
          />
        </div>
      ),
    },
    {
      title: t('leftPanel.width'),
      dataIndex: 'width',
      width: 90,
      render: (v: number, r, i) => (
        <div className={r.confirmed ? undefined : 'ai-cell'} style={{ borderRadius: 6, padding: 2 }}>
          <InputNumber
            size="small"
            variant="borderless"
            min={1}
            value={v}
            style={{ width: '100%' }}
            onChange={(x) => s.patchRow(i, { width: x ?? 0 })}
          />
        </div>
      ),
    },
    {
      title: t('leftPanel.quantity'),
      dataIndex: 'quantity',
      width: 80,
      render: (v: number, r, i) => (
        <div className={r.confirmed ? undefined : 'ai-cell'} style={{ borderRadius: 6, padding: 2 }}>
          <InputNumber
            size="small"
            variant="borderless"
            min={1}
            step={1}
            value={v}
            style={{ width: '100%' }}
            onChange={(x) => s.patchRow(i, { quantity: qty(x ?? 0) })}
          />
        </div>
      ),
    },
    {
      title: t('review.aiCell'),
      width: 110,
      render: (_, r) => (
        <Tooltip title={`confidence ${Math.round(r.confidence * 100)}%`}>
          <Tag color={r.confirmed ? 'green' : r.edited ? 'blue' : 'orange'}>
            {r.confirmed
              ? t('review.statusConfirmed')
              : r.edited
                ? t('review.statusEdited')
                : `${t('review.statusPending')} · ${Math.round(r.confidence * 100)}%`}
          </Tag>
        </Tooltip>
      ),
    },
  ]

  return (
    <div className="review-overlay" role="dialog" aria-modal="true" aria-label={t('review.title')}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          height: 56,
          padding: '0 20px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
          flexShrink: 0,
        }}
      >
        <Button type="text" icon={<CloseOutlined />} onClick={s.close} aria-label={t('common.close')} />
        <span style={{ fontWeight: 600, fontSize: 15 }}>{t('review.title')}</span>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('review.creditNotice')}</span>
        <div style={{ flex: 1 }} />
        <Button icon={<CameraOutlined />} onClick={() => fileRef.current?.click()}>
          {t('review.reTake')}
        </Button>
        <Button
          type="primary"
          icon={<ScanOutlined />}
          onClick={() => void onRecognize()}
          loading={s.recognizing}
          disabled={!s.image}
        >
          {s.recognizing ? t('review.recognizing') : t('review.recognize')}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => void pickFile(e.target.files?.[0])}
        />
      </div>

      <div className="review-body">
        <div
          className="review-image"
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            void pickFile(e.dataTransfer.files?.[0])
          }}
          onClick={() => fileRef.current?.click()}
          style={{ cursor: s.image ? 'default' : 'pointer', outline: dragOver ? '2px dashed var(--accent)' : undefined }}
        >
          {s.image ? (
            <img src={s.image} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8 }} />
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
              <CameraOutlined style={{ fontSize: 40, marginBottom: 12, display: 'block' }} />
              {t('review.dropHint')}
            </div>
          )}
        </div>

        <div className="review-table">
          {s.error && (
            <div
              style={{
                background: 'rgba(224,49,49,0.08)',
                color: 'var(--danger, #E03131)',
                padding: '10px 14px',
                borderRadius: 8,
                marginBottom: 12,
                fontSize: 13,
              }}
            >
              {s.error}
            </div>
          )}

          {s.rows.length === 0 && !s.recognizing ? (
            <div style={{ color: 'var(--text-disabled)', textAlign: 'center', marginTop: 60 }}>
              {t('review.empty')}
            </div>
          ) : (
            <>
              <Table<ReviewRow>
                size="small"
                rowKey={(r) => `${r.name}-${r.length}-${r.width}`}
                columns={columns}
                dataSource={s.rows}
                pagination={false}
                scroll={{ y: 'calc(100vh - 220px)' }}
                locale={{ emptyText: t('review.empty') }}
              />
              <div style={{ display: 'flex', gap: 12, marginTop: 16, justifyContent: 'flex-end', alignItems: 'center' }}>
                <Button icon={<CheckCircleOutlined />} onClick={s.confirmAll}>
                  {t('review.confirmAll')}
                </Button>
                <Button type="primary" icon={<EditOutlined />} onClick={onImport}>
                  {t('review.importParts')}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
