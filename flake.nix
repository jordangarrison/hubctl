{
  description = "hubctl - agent-first GitHub administration CLI (Bun + TypeScript + Effect)";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        # Toolchain provided by Nix. Bun is the runtime / package manager and
        # drives the project scripts; Node is kept on PATH because a few dev
        # tools still shell out to a Node resolver. The rest of the toolchain
        # (oxlint, oxfmt, tsgo, vitest, ast-grep, fallow, commitlint) is pinned
        # in package.json and installed by `bun install` rather than Nix, so the
        # exact versions match CI.
        devTools = with pkgs; [
          bun
          nodejs_22
          git
          # ast-grep ships a generic glibc binary via npm that NixOS can't run
          # (the dynamic-linker stub issue), so provide it from nixpkgs instead.
          # The package.json `ast-grep`/`ast-grep:test` scripts resolve this one
          # off PATH since @ast-grep/cli is intentionally not an npm dep.
          ast-grep
        ];
      in
      {
        # The compiled-binary package derivation is added in the cutover phase
        # (Phase 10), once src/ exists. Until then this flake provides the dev
        # shell only.
        devShells.default = pkgs.mkShell {
          buildInputs = devTools;

          shellHook = ''
            echo "🚀 hubctl dev environment (Bun + TypeScript + Effect)"
            echo "Bun:  $(bun --version)"
            echo "Node: $(node --version)"
            echo ""
            echo "Quick start:"
            echo "  bun install        # install the toolchain + deps"
            echo "  bun run validate   # format + lint + typecheck + test + ast-grep"
            echo "  bun run dev -- --help"
          '';
        };
      }
    );
}
