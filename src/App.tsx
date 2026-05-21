import { Routes, Route, Navigate } from 'react-router-dom'
import TeacherPage from './pages/TeacherPage'
import ProjectorPage from './pages/ProjectorPage'
import StudentPage from './pages/StudentPage'

export default function App() {
  return (
    <Routes>
      <Route path="/teacher" element={<TeacherPage />} />
      <Route path="/projector" element={<ProjectorPage />} />
      <Route path="/student" element={<StudentPage />} />
      <Route path="*" element={<Navigate to="/student" replace />} />
    </Routes>
  )
}
