import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './routes/ProtectedRoute'
import PublicOnlyRoute from './routes/PublicOnlyRoute'
import RequireProject from './routes/RequireProject'

import Login from './pages/Login'
import SignUp from './pages/SignUp'
import Welcome from './pages/Welcome'
import CreateProject from './pages/CreateProject'
import JoinProject from './pages/JoinProject'
import Dashboard from './pages/Dashboard'
import Issues from './pages/Issues'
import CreateIssue from './pages/CreateIssue'
import IssueDetail from './pages/IssueDetail'
import MyTasks from './pages/MyTasks'
import Members from './pages/Members'
import Notifications from './pages/Notifications'
import ProjectSettings from './pages/ProjectSettings'
import AccountSettings from './pages/AccountSettings'
import ArchivedProjects from './pages/ArchivedProjects'
import NotFound from './pages/NotFound'

function App() {
  return (
    <Routes>
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<SignUp />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/projects/new" element={<CreateProject />} />
        <Route path="/projects/join" element={<JoinProject />} />
        <Route path="/projects/archived" element={<ArchivedProjects />} />
        <Route path="/account-settings" element={<AccountSettings />} />

        <Route element={<RequireProject />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/issues" element={<Issues />} />
          <Route path="/issues/new" element={<CreateIssue />} />
          <Route path="/issues/:issueId" element={<IssueDetail />} />
          <Route path="/my-tasks" element={<MyTasks />} />
          <Route path="/members" element={<Members />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/project-settings" element={<ProjectSettings />} />
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

export default App
