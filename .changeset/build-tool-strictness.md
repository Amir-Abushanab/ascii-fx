---
'@ascii-fx/compiler': minor
'@ascii-fx/vite': minor
---

Two of these can break a build that was relying on the old behaviour.

- **CLI:** `--flag=value` works, and an unknown flag or a valued flag with no value is an error. `--columns=160` and a misspelt `--colums 160` both used to build the default grid and exit 0. A value that starts with a dash now needs the `=` form: `--characters=-=+#`.
- **Vite plugin:** `font` and `image` paths in a config file resolve against that file, as the config types have always said, rather than against the Vite root. Nothing changes for a config at the project root, which is the default. If yours lives in a subdirectory and its paths were written relative to the root, make them relative to the config file.
- **Vite README:** the import example used `virtual:ascii-profile/default?url`, which does not resolve. The module is imported without a query and its default export is `{ url, id }`.
