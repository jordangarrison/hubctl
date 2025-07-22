{
  description = "hubctl - A comprehensive GitHub administration CLI";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };

        # Ruby version to use
        ruby = pkgs.ruby_3_3;

        # Simple wrapper script that uses the local bundler environment
        hubctl = pkgs.writeShellScriptBin "hubctl" ''
          set -e

          # Work from current directory, not Nix store
          if [ ! -f "bin/hubctl" ]; then
            echo "Error: Must run from hubctl project directory" >&2
            exit 1
          fi

          # Ensure gems are installed in current directory
          if [ ! -d "vendor/bundle" ]; then
            echo "Installing gems..." >&2
            ${pkgs.bundler}/bin/bundle config set --local deployment true
            ${pkgs.bundler}/bin/bundle config set --local path vendor/bundle
            ${pkgs.bundler}/bin/bundle install --quiet
          fi

          # Run hubctl with proper environment from current directory
          export BUNDLE_DEPLOYMENT=true
          export BUNDLE_PATH=vendor/bundle
          ${pkgs.bundler}/bin/bundle exec ${ruby}/bin/ruby bin/hubctl "$@"
        '';

      in
      {
        packages.default = hubctl;
        packages.hubctl = hubctl;

        # Development shell with all Ruby dependencies
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            ruby
            bundler
            # Native extension build dependencies
            gcc
            pkg-config
            libxml2
            libxslt
            libyaml
            openssl
            zlib
            gnumake
          ] ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [
            # macOS-specific dependencies
            clang
          ];

          shellHook = ''
            echo "🚀 hubctl development environment"
            echo "Ruby: $(ruby --version)"
            echo "Bundler: $(bundle --version)"
            echo ""
            echo "Quick start:"
            echo "  bundle install    # Install gems"
            echo "  ./bin/hubctl --help    # Test CLI directly"
            echo "  nix run . -- --help   # Test via Nix"
          '';
        };

        # App runner
        apps.default = {
          type = "app";
          program = "${hubctl}/bin/hubctl";
        };
      }
    );
}
