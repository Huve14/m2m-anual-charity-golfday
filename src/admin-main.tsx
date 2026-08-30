import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AdminRoot } from "./admin/AdminApp";
import "./ops/ops.css";

const root = document.getElementById("admin-root");
if (!root) throw new Error("Admin root element not found");
createRoot(root).render(<StrictMode><AdminRoot /></StrictMode>);

