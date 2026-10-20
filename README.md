# РОКАС — трекер задач и встреч

Внешняя память команды: всё, что человек пообещал себе или коллеге,
остаётся на виду, пока не решено. Концепция — равноправие всех участников
и конфиденциальность личных данных.

Боевой адрес: https://task-tracker-beta-ebon.vercel.app

**Начните с [docs/HANDOFF.md](docs/HANDOFF.md)** — цель, концепция,
подходы, карта системы и что учесть при внедрении. Правила поведения —
[docs/how-it-works.md](docs/how-it-works.md), инженерный журнал —
[CLAUDE.md](CLAUDE.md).

```bash
npm install
npm run dev     # нужен .env.local, список переменных — в docs/HANDOFF.md, раздел 9
npm test && npm run lint && npm run build
```
