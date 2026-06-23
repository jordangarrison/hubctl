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

        # fallow (dead-code audit) ships only as a prebuilt generic-glibc binary
        # on npm, which NixOS can't run directly, and it isn't in nixpkgs. The
        # recommended NixOS pattern for a prebuilt binary is autoPatchelfHook —
        # self-contained in this flake, no system dependency (no nix-ld). Built
        # for x86_64-linux (the dev/CI target); other systems omit it.
        fallow = pkgs.stdenvNoCC.mkDerivation rec {
          pname = "fallow";
          version = "2.101.0";
          src = pkgs.fetchurl {
            url = "https://registry.npmjs.org/@fallow-cli/linux-x64-gnu/-/linux-x64-gnu-${version}.tgz";
            hash = "sha256-SXlHYSok+70ZcrsobHhcuYxAOAZzlTCNCx6sfeTjja8=";
          };
          sourceRoot = "package";
          nativeBuildInputs = [ pkgs.autoPatchelfHook ];
          buildInputs = [ pkgs.stdenv.cc.cc.lib ];
          installPhase = ''
            runHook preInstall
            install -Dm755 fallow $out/bin/fallow
            runHook postInstall
          '';
        };

        supportsFallow = system == "x86_64-linux";

        pkgVersion = (builtins.fromJSON (builtins.readFile ./package.json)).version;

        # Dependencies as a fixed-output derivation: `bun install` needs network,
        # which only FODs are granted inside the Nix sandbox. `--ignore-scripts`
        # skips the language-service/tsgo postinstall patches (dev-only; not
        # needed to compile the binary) and keeps the output deterministic. Bump
        # `outputHash` whenever bun.lock changes (nix prints the correct hash on
        # mismatch).
        bunDeps = pkgs.stdenvNoCC.mkDerivation {
          pname = "hubctl-bun-deps";
          version = pkgVersion;
          src = pkgs.lib.fileset.toSource {
            root = ./.;
            fileset = pkgs.lib.fileset.unions [ ./package.json ./bun.lock ];
          };
          nativeBuildInputs = [ pkgs.bun ];
          dontConfigure = true;
          buildPhase = ''
            export HOME=$TMPDIR
            export BUN_INSTALL_CACHE_DIR=$TMPDIR/.bun-cache
            bun install --frozen-lockfile --no-progress --ignore-scripts
          '';
          installPhase = ''
            mkdir -p $out
            cp -R node_modules $out/node_modules
          '';
          dontFixup = true;
          outputHashMode = "recursive";
          outputHashAlgo = "sha256";
          outputHash = "sha256-7QFy4kwInVcJSlYEVr9uxIRSqk+nBQ1TtAsJFBwo0cQ=";
        };

        # The Nix package runs the app via nixpkgs' `bun` (already patched for
        # NixOS) over `src/main.ts`, with deps vendored from the FOD above. We do
        # NOT ship the `bun build --compile` artifact through Nix: autoPatchelf
        # rewrites the ELF and breaks Bun's self-detection of the bundle appended
        # to the executable (the binary then can't find its embedded app). The
        # true standalone single-file binary is still produced by `bun run
        # build:local` / scripts/compile.ts and shipped as a release artifact;
        # `main.ts` slices `process.argv.slice(2)`, which lines up with bun's
        # `[bun, main.ts, ...args]` argv, so the wrapper is invisible to the CLI.
        hubctl = pkgs.stdenvNoCC.mkDerivation {
          pname = "hubctl";
          version = pkgVersion;
          src = pkgs.lib.fileset.toSource {
            root = ./.;
            fileset = pkgs.lib.fileset.unions [
              ./src
              ./package.json
              ./bun.lock
              ./tsconfig.json
              ./tsconfig.base.json
            ];
          };
          nativeBuildInputs = [ pkgs.makeWrapper ];
          dontConfigure = true;
          dontBuild = true;
          installPhase = ''
            runHook preInstall
            mkdir -p $out/share/hubctl
            cp -R src package.json tsconfig.json tsconfig.base.json $out/share/hubctl/
            cp -R ${bunDeps}/node_modules $out/share/hubctl/node_modules
            makeWrapper ${pkgs.bun}/bin/bun $out/bin/hubctl \
              --add-flags "$out/share/hubctl/src/main.ts"
            runHook postInstall
          '';
        };

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
        ] ++ pkgs.lib.optionals supportsFallow [ fallow ];
      in
      {
        packages = {
          default = hubctl;
          hubctl = hubctl;
        };

        apps.default = {
          type = "app";
          program = "${hubctl}/bin/hubctl";
        };

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
