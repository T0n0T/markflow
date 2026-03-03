import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MilkdownProvider } from '@milkdown/react'

import './index.css'
import App from './App'
import { Toaster } from '@/components/ui/sonner'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MilkdownProvider>
      <App />
    </MilkdownProvider>
    <Toaster />
  </StrictMode>,
)
