import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HostRoot } from "./host/HostApp";
import "./ops/ops.css";

const root = document.getElementById("host-root");
if (!root) throw new Error("Host root element not found");
createRoot(root).render(<StrictMode><HostRoot /></StrictMode>);

