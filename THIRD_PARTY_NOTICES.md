# Third-party notices

Lore is licensed under the Apache License, Version 2.0 (see `LICENSE`). The
shipped skills listed below were adapted from open source works and keep their
original licences. Each skill file also carries an `## Attribution` section.

All skill files named here were modified by re:cinq. Upstream commit read for
this notice: `cd4028d57d6e4e95814f7b8ee55ca13c23a9c2f0` of https://github.com/citypaul/.dotfiles (2026-10-02),
skills under `claude/.claude/skills/`.

## citypaul/.dotfiles, MIT, Copyright (c) 2024 Paul Hammond

Source: https://github.com/citypaul/.dotfiles/tree/cd4028d57d6e4e95814f7b8ee55ca13c23a9c2f0/claude/.claude/skills
Licence: MIT, from the repository root `LICENSE`.

Files in this repository:

- `libs/shared/src/agent-defaults/skills/domain-driven-design.md`
- `libs/shared/src/agent-defaults/skills/event-sourcing.md`
- `libs/shared/src/agent-defaults/skills/front-end-testing.md`
- `libs/shared/src/agent-defaults/skills/functional.md`
- `libs/shared/src/agent-defaults/skills/hexagonal-architecture.md`
- `libs/shared/src/agent-defaults/skills/mutation-testing.md`
- `libs/shared/src/agent-defaults/skills/observability.md`
- `libs/shared/src/agent-defaults/skills/react-testing.md`
- `libs/shared/src/agent-defaults/skills/structure-codebase.md`
- `libs/shared/src/agent-defaults/skills/test-design-reviewer.md`
- `libs/shared/src/agent-defaults/skills/testing.md`
- `libs/shared/src/agent-defaults/skills/twelve-factor.md`
- `libs/shared/src/agent-defaults/skills/typescript-strict.md`
- `libs/shared/src/agent-defaults/skills/ubiquitous-language.md`

Changes: each skill was shortened into a single file, pointers to companion
files and to skills outside this catalogue were removed, and a Help section was
added. `testing`, `front-end-testing` and `react-testing` were rewritten much
shorter with one example per rule. `twelve-factor` is based on 12factor.net, as
the upstream skill states. `test-design-reviewer` was adapted from the current
upstream skill, which upstream describes as an original implementation of Dave
Farley's eight properties.

```text
MIT License

Copyright (c) 2024 Paul Hammond

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Addy Osmani, agent-skills, MIT, Copyright (c) 2025 Addy Osmani

Source: the `api-and-interface-design` skill in https://github.com/addyosmani/agent-skills, adapted in
https://github.com/citypaul/.dotfiles/tree/cd4028d57d6e4e95814f7b8ee55ca13c23a9c2f0/claude/.claude/skills/api-design
Licence: MIT, from `api-design/LICENSE` in that repository, which governs its directory.

Files in this repository:

- `libs/shared/src/agent-defaults/skills/api-design.md`

Changes: shortened into a single file, pointers to companion files and to skills outside this catalogue removed, a Help section added.

```text
MIT License

Copyright (c) 2025 Addy Osmani

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Matt Pocock, skills, MIT, Copyright (c) 2026 Matt Pocock

Source: the `improve-codebase-architecture` skill and HTML report resource at
https://github.com/mattpocock/skills/tree/66898f60e8c744e269f8ce06c2b2b99ce7660d5f/skills/engineering/improve-codebase-architecture,
adapted in https://github.com/citypaul/.dotfiles/tree/cd4028d57d6e4e95814f7b8ee55ca13c23a9c2f0/claude/.claude/skills/improve-codebase-architecture
Licence: MIT, from `improve-codebase-architecture/LICENSE` in that repository, which governs its directory.

Files in this repository:

- `libs/shared/src/agent-defaults/skills/improve-codebase-architecture.md`

Changes: shortened into a single file, pointers to companion files and to skills outside this catalogue removed, a Help section added.

```text
MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Command Line Interface Guidelines, CC BY-SA 4.0

Original work: *Command Line Interface Guidelines* (https://clig.dev/), at the pinned revision
https://github.com/cli-guidelines/cli-guidelines/blob/697d6a29fc8c93d3981a755c0c7683507ad39c3e/content/_index.md
Adapted in https://github.com/citypaul/.dotfiles/tree/cd4028d57d6e4e95814f7b8ee55ca13c23a9c2f0/claude/.claude/skills/cli-design,
whose `cli-design/LICENSE` states that the directory is licensed under CC BY-SA 4.0, not the repository-root MIT licence.

Authors: Aanand Prasad, Ben Firshman, Carl Tashian and Eva Parish.

Licence: Creative Commons Attribution-ShareAlike 4.0 International,
https://creativecommons.org/licenses/by-sa/4.0/ (legal code: https://creativecommons.org/licenses/by-sa/4.0/legalcode).

Files in this repository:

- `libs/shared/src/agent-defaults/skills/cli-design.md`

Changes: this file is a modified adaptation. It was shortened into a single file, pointers to companion files and to skills outside this catalogue were removed, and a Help section was added. No endorsement by the original authors is implied.

This file stays under CC BY-SA 4.0 and is not covered by the Apache License of the rest of this repository.
