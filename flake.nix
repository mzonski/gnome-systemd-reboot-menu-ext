{
  description = "Reboot menu extended - Gnome extension";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    dream2nix.url = "github:nix-community/dream2nix";
    dream2nix.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    inputs@{ dream2nix, flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      perSystem =
        {
          config,
          self',
          inputs',
          pkgs,
          system,
          ...
        }:
        let
          metadata = builtins.fromJSON (builtins.readFile ./src/metadata.json);
          packageJson = builtins.fromJSON (builtins.readFile ./package.json);

          buildInputs = with pkgs; [
            nodejs
            gnumake
            gettext
            zip
          ];

          nodeProject = dream2nix.lib.evalModules {
            packageSets.nixpkgs = pkgs;
            modules = [
              {
                name = "systemdrebootmenuext-deps";
                version = packageJson.version;

                imports = [
                  dream2nix.modules.dream2nix.nodejs-package-lock-v3
                  dream2nix.modules.dream2nix.nodejs-granular-v3
                ];

                mkDerivation = {
                  src = ./.;
                  dontBuild = true;
                  dontInstall = true;
                };

                nodejs-package-lock-v3 = {
                  packageLockFile = ./package-lock.json;
                };
              }
            ];
          };

          gnomeExtension = pkgs.stdenv.mkDerivation {
            pname = "gnome-shell-extension-systemdrebootmenuext";
            version = packageJson.version;

            src = ./.;

            nativeBuildInputs = buildInputs;

            buildInputs = [ nodeProject ];

            buildPhase = ''
              runHook preBuild

              ln -sf ${nodeProject}/lib/node_modules/systemdrebootmenuext-deps/node_modules ./node_modules
              make dist/extension.js

              cp src/metadata.json dist/
              cp src/stylesheet.css dist/

              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall

              mkdir -p $out/share/gnome-shell/extensions/
              cp -r dist/. $out/share/gnome-shell/extensions/${metadata.uuid}

              runHook postInstall
            '';

            meta = with pkgs.lib; {
              description = metadata.name;
              longDescription = metadata.description;
              homepage = metadata.url;
              license = licenses.gpl3Plus;
              platforms = platforms.linux;
              maintainers = [ ];
            };

            passthru = {
              extensionPortalSlug = "systemdrebootmenuext";
              extensionUuid = metadata.uuid;
            };
          };
        in
        {
          packages = {
            default = gnomeExtension;
            systemdrebootmenuext = gnomeExtension;
          };

          devShells.default = pkgs.mkShell {
            inherit buildInputs;

            shellHook = ''
              if [ -d "node_modules/.bin" ]; then
                  export PATH="$PATH:$PWD/node_modules/.bin"
              else
                  echo "Error: node_modules/.bin directory not found" >&2
              fi
            '';
          };
        };
    };
}
