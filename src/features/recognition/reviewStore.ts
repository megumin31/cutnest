/**
 * 识别审查 store —— 模态开关 / 图片 / 识别行状态（会话态）。
 */
import { create } from 'zustand'
import type { RecognizedSheet, ReviewRow } from '../../domain/types'
import { useAppStore } from '../cutting/planStore'

interface ReviewState {
  isOpen: boolean
  image: string | null
  recognizing: boolean
  error: string | null
  rawText: string
  rows: ReviewRow[]
  open: () => void
  close: () => void
  setImage: (dataUrl: string | null) => void
  setRows: (rows: ReviewRow[]) => void
  patchRow: (index: number, patch: Partial<ReviewRow>) => void
  confirmAll: () => void
  setRecognizing: (v: boolean) => void
  setError: (e: string | null) => void
  acceptSheet: (sheet: RecognizedSheet) => void
  requireLogin: () => void
}

export const useReviewStore = create<ReviewState>((set) => ({
  isOpen: false,
  image: null,
  recognizing: false,
  error: null,
  rawText: '',
  rows: [],

  open: () => set({ isOpen: true, error: null }),
  close: () =>
    set({ isOpen: false, image: null, rows: [], rawText: '', error: null, recognizing: false }),
  setImage: (image) => set({ image, error: null }),
  setRows: (rows) => set({ rows }),
  patchRow: (index, patch) =>
    set((s) => ({
      rows: s.rows.map((r, i) =>
        i === index ? { ...r, ...patch, confirmed: false, edited: true } : r,
      ),
    })),
  confirmAll: () => set((s) => ({ rows: s.rows.map((r) => ({ ...r, confirmed: true })) })),
  setRecognizing: (recognizing) => set({ recognizing }),
  setError: (error) => set({ error }),
  acceptSheet: (sheet) =>
    set({
      rows: sheet.items.map((it) => ({
        name: it.name,
        length: it.length,
        width: it.width,
        quantity: it.quantity,
        confidence: it.confidence,
        confirmed: false,
        edited: false,
      })),
      rawText: sheet.rawText,
    }),
  requireLogin: () => {
    set({ isOpen: false })
    useAppStore.getState().navigate('account')
  },
}))
