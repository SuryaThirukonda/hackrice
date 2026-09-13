import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import VitalsLab from './VitalsLab'

createRoot(document.getElementById('root')!).render(<StrictMode><VitalsLab /></StrictMode>)
