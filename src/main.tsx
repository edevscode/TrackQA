import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './contexts/AuthContext'
import { ProjectProvider } from './contexts/ProjectContext'
import { SidebarProvider } from './contexts/SidebarContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ProjectProvider>
          <SidebarProvider>
            <App />
          </SidebarProvider>
        </ProjectProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
