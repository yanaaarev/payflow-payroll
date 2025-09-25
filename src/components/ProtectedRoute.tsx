import { Navigate, Outlet } from 'react-router-dom';

const ProtectedRoute = () => {
  const user = localStorage.getItem('user');

  if (!user) {
    // No user → redirect to login
    return <Navigate to="/" replace />;
  }

  // User exists → render child route
  return <Outlet />;
};

export default ProtectedRoute;