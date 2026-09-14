import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PhotoApp } from "./photos/PhotoApp";
import "./ops/ops.css";
import "./photos/photos.css";
createRoot(document.getElementById("photos-root")!).render(
  <StrictMode>
    <PhotoApp />
  </StrictMode>,
);
