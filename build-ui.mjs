import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const landing = await readFile(
  path.join(root, "landing.fragment.html"),
  "utf8",
);
const app = await readFile(path.join(root, "app.fragment.html"), "utf8");
const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#442ad9">
  <meta name="description" content="تسويقات: مساحة عمل عربية تجمع قنوات نشاطك ومحتواه وحملاته وخطط النشر في مكان واحد، لكل تاجر وشركة في السوق العربي.">
  <title>تسويقات — كل قنواتك في مكان واحد</title>
  <link rel="icon" href="assets/logo.svg" type="image/svg+xml">
  <link rel="stylesheet" href="assets/styles.css">
  <link rel="stylesheet" href="assets/landing.css">
  <link rel="stylesheet" href="assets/pulse.css">
  <link rel="stylesheet" href="assets/session.css">
</head>
<body>
${landing}
${app}
  <script src="assets/deployment.js"></script>
  <script src="assets/client-api.js"></script>
  <script src="assets/app.js"></script>
  <script src="assets/site-settings.js"></script>
</body>
</html>
`;
await writeFile(path.join(root, "index.html"), html);
await mkdir(path.join(root, "dist"), { recursive: true });
await writeFile(path.join(root, "dist/index.html"), html);
await cp(path.join(root, "assets"), path.join(root, "dist/assets"), {
  recursive: true,
});
await cp(
  path.join(root, "manus-routes.json"),
  path.join(root, "dist/manus-routes.json"),
);
await cp(path.join(root, "admin.html"), path.join(root, "dist/admin.html"));
console.log("Taswiqat customer and operator interfaces assembled: index.html and dist/");
