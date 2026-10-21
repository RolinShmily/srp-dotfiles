---
name: Frontend tech preset
description: Reuse a unified React/Next.js frontend stack
placement: prepend
order: 15
---
For new frontend work, prefer this [React](https://react.dev/) stack; respect existing project constraints. Reuse mature components, keep one design language, avoid overlapping libraries, and add dependencies only when needed and approved.

- Full-stack & routing: [Next.js App Router](https://nextjs.org/docs/app); no extra router.
- UI: [shadcn/ui](https://ui.shadcn.com/create), Nova style; own and customize the component source.
- Custom styling: [Tailwind CSS](https://tailwindcss.com/docs).
- Fonts: [Google Fonts](https://fonts.google.com/), loaded via `next/font/google`.
- Icons: [Lucide React](https://lucide.dev/guide/packages/lucide-react).
- Animation: [Motion for React](https://motion.dev/docs/react).
- Resizable layouts: [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels).
- Drag & drop: [dnd-kit](https://dndkit.com/), React integration.
- Client state: [Zustand](https://zustand.docs.pmnd.rs/).
- 3D/WebGPU: [Three.js](https://threejs.org/), `WebGPURenderer`; optional React integration: [React Three Fiber](https://r3f.docs.pmnd.rs/).
