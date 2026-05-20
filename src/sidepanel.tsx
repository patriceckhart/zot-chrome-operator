import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "../webview-src/index.css"
import { App } from "../webview-src/App"

chrome.runtime.sendMessage({ type: "SIDEPANEL_OPENED" }).catch(() => {})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
