with (import <nixpkgs> {});
let
  env = bundlerEnv {
    name = "hubctl-bundler-env";
    inherit ruby;
    gemfile  = ./Gemfile;
    lockfile = ./Gemfile.lock;
    gemset   = ./gemset.nix;
  };
in stdenv.mkDerivation {
  name = "hubctl";
  buildInputs = [ env ];
}
