# prelegal

> **🚧 Status: In Progress**
>
> This project is under active development and is targeted for completion by **August 1, 2026**.

## About

`prelegal` is currently in early development. Documentation covering the project's
purpose, setup, and usage will be filled in as the implementation lands.

## Frontend

`frontend/` holds a Next.js app that turns the Common Paper Mutual NDA into a
fillable document. You answer the Cover Page questions on the left, the agreement
fills in beside you, and "Download PDF" hands the finished document to the
browser's print dialog.

```bash
cd frontend
npm install
npm run dev      # http://localhost:3000
```

`npm run build`, `npm run lint`, and `npm run typecheck` are also available.

Everything runs in the browser — there is no backend, and nothing you type leaves
your machine. The agreement text lives in `frontend/lib/nda/`; the templates in
`templates/` remain the canonical source of record.

## Roadmap

- [x] Mutual NDA creator (PL-3)
- [ ] Remaining agreement types from `catalog.json`
- [ ] Documentation: overview, installation, and usage
- [ ] Target completion — August 1, 2026

## Contributing

The project is not yet ready for outside contributions. Please check back once the
initial implementation is complete.

## License

See [LICENSE](LICENSE).
