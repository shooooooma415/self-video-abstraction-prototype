import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  // If another local process already uses 5174, Vite automatically selects the next free port.
  server: { port: 5174 },
  preview: { port: 4174, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
})
