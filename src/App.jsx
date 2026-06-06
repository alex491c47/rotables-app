import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Analytics from './pages/Analytics'
import Editor from './pages/Editor'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/analytics" element={<Analytics />} />
      <Route path="/editor" element={<Editor />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
