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

        # Package that works both locally and remotely
        hubctl = pkgs.stdenv.mkDerivation rec {
          pname = "hubctl";
          version = "0.1.0";

          src = ./.;

          nativeBuildInputs = [ ruby pkgs.bundler ] ++ (with pkgs; [
            # Native extension build dependencies
            pkg-config
            libxml2
            libxslt
            libyaml
            openssl
            zlib
            gnumake
          ]) ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [
            # macOS-specific dependencies
            pkgs.clang
          ];

          buildPhase = ''
            export HOME=$TMPDIR
            export GEM_HOME=$out/lib/ruby/gems
            export BUNDLE_PATH=$out/lib/ruby/gems

            # Clean any existing config
            rm -rf .bundle || true

            # Install gems into the output
            bundle config set path $out/lib/ruby/gems
            bundle install --quiet --no-deployment
          '';

          installPhase = ''
            mkdir -p $out/bin $out/src

            # Copy all source files
            cp -r lib $out/src/
            cp -r bin $out/src/
            cp Gemfile Gemfile.lock $out/src/ 2>/dev/null || true

            # Create wrapper script
            cat > $out/bin/hubctl << EOF
            #!/bin/sh
            export GEM_HOME=$out/lib/ruby/gems
            export BUNDLE_PATH=$out/lib/ruby/gems
            cd $out/src
            exec ${ruby}/bin/ruby -I$out/src/lib bin/hubctl "\$@"
            EOF
                        chmod +x $out/bin/hubctl
          '';
        };

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
