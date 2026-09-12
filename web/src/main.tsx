import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import Join from './controller/Join'

const Projector = lazy(() => import('./projector/Projector'))
const Remote = lazy(() => import('./remote/Remote'))
const Controller = lazy(() => import('./controller/Controller'))
const Host = lazy(() => import('./host/Host'))
const Rail = lazy(() => import('./rail/Rail'))

const router = createBrowserRouter([
  { path: '/', element: <Join /> },
  { path: '/remote', element: <Suspense fallback={null}><Remote /></Suspense> },
  { path: '/controller', element: <Suspense fallback={null}><Controller /></Suspense> },
  { path: '/rail', element: <Suspense fallback={null}><Rail /></Suspense> },
  { path: '/projector', element: <Suspense fallback={null}><Projector /></Suspense> },
  { path: '/host', element: <Suspense fallback={null}><Host /></Suspense> },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
)
