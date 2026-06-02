import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// 全局禁用 WebView 默认右键菜单
document.addEventListener("contextmenu", (e) => e.preventDefault());

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("根节点 #root 未找到，index.html 可能损坏");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
