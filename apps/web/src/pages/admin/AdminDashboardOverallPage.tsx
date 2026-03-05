import { Navigate } from "react-router-dom";

// Redirected to consolidated dashboard (AdminDashboardNormalPage handles both stages)
export function AdminDashboardOverallPage() {
  return <Navigate to="/admin/dashboard" replace />;
}
