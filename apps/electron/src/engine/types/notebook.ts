// Stub: Notebook types inferred from usage in utils/notebook.ts

export type NotebookOutputImage = {
  image_data: string
  media_type: 'image/png' | 'image/jpeg'
}

export type NotebookCellSourceOutput = {
  output_type: string
  text?: string
  image?: NotebookOutputImage
}

export type NotebookCellSource = {
  cellType: string
  source: string
  execution_count?: number
  cell_id: string
  language?: string
  outputs?: (NotebookCellSourceOutput | undefined)[]
}

export type NotebookCellOutput = {
  output_type: 'stream' | 'execute_result' | 'display_data' | 'error'
  text?: string | string[]
  data?: Record<string, unknown>
  ename?: string
  evalue?: string
  traceback?: string[]
}

export type NotebookCell = {
  id?: string
  cell_type: string
  source: string | string[]
  execution_count?: number | null
  outputs?: NotebookCellOutput[]
  metadata?: Record<string, unknown>
}

export type NotebookContent = {
  metadata: {
    language_info?: {
      name?: string
    }
  }
  cells: NotebookCell[]
  nbformat?: number
  nbformat_minor?: number
}
