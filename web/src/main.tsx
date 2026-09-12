import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider, Link } from 'react-router-dom'
import './index.css'
import { PlankMenu } from './ui/ChannelGrid'

const Projector = lazy(() => import('./projector/Projector'))
const Remote = lazy(() => import('./remote/Remote'))
const Controller = lazy(() => import('./controller/Controller'))
const Host = lazy(() => import('./host/Host'))
const Rail = lazy(() => import('./rail/Rail'))
const Index = () => (
  <div style={{ maxWidth: 980, margin: '0 auto', padding: 28 }}>
    <h1 style={{ fontSize: 34, fontWeight: 900, margin: '0 0 6px' }}>The House Always Plays</h1>
    <p style={{ color: 'var(--ink-2)', fontWeight: 700, margin: '0 0 22px' }}>Pick a channel on the projector to start a match. <Link to="/projector">Projector</Link> · <Link to="/host">Host</Link> · <Link to="/rail">Rail</Link> · <Link to="/controller?player=1">Phone controller</Link></p>
    <div style={{ height: 520 }}><PlankMenu /></div>
  </div>
)

const router = createBrowserRouter([
  { path: '/', element: <Index /> },
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
