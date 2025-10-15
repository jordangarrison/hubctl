{
  description = "hubctl - A comprehensive GitHub administration CLI with Enterprise management";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        # Ruby gems environment using bundlerEnv
        gems = pkgs.bundlerEnv {
          name = "hubctl-gems";
          ruby = pkgs.ruby_3_3;
          gemfile = ./Gemfile;
          lockfile = ./Gemfile.lock;
          gemset = ./gemset.nix;

          # Override problematic gems with nixpkgs versions
          gemConfig = pkgs.defaultGemConfig // {
            nokogiri = attrs: {
              buildInputs = with pkgs; [ rubyPackages_3_3.nokogiri ];
            };
          };
        };

        # Main package
        hubctl = pkgs.stdenv.mkDerivation {
          pname = "hubctl";
          version = "0.3.1";
          src = self;

          buildInputs = [ gems pkgs.ruby_3_3 ];
          nativeBuildInputs = [ pkgs.makeWrapper ];

          installPhase = ''
            mkdir -p $out/bin $out/app
            cp -r lib $out/app/
            cp -r bin $out/app/

            # Create wrapper script with proper library paths
            makeWrapper ${pkgs.ruby_3_3}/bin/ruby $out/bin/hubctl \
              --set GEM_HOME "${gems}/${gems.ruby.gemPath}" \
              --set GEM_PATH "${gems}/${gems.ruby.gemPath}" \
              --prefix LD_LIBRARY_PATH : "${pkgs.ruby_3_3}/lib" \
              --add-flags "-I$out/app/lib" \
              --add-flags "$out/app/bin/hubctl"
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
