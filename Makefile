NAME=systemdrebootmenuext
DOMAIN=zonni.pl

.PHONY: all pack install clean

all: dist/extension.js

node_modules:
	npm install

dist/extension.js: node_modules
	@ ./node_modules/typescript/bin/tsc

$(NAME)@$(DOMAIN).zip: dist/extension.js
	@cp src/metadata.json dist/
	@(cd dist && zip ../$(NAME)@$(DOMAIN).zip -9r .)

pack: $(NAME)@$(DOMAIN).zip

install: $(NAME)@$(DOMAIN).zip
	@[ -d ~/.local/share/gnome-shell/extensions ] || mkdir -p ~/.local/share/gnome-shell/extensions
	@gnome-extensions install $(NAME)@$(DOMAIN).zip --force

redeploy:
	@rm -rf ~/.local/share/gnome-shell/extensions/$(NAME)@$(DOMAIN).zip
	@ ./node_modules/typescript/bin/tsc
	@$(MAKE) pack
	@$(MAKE) install

clean:
	@rm -rf dist node_modules $(NAME)@$(DOMAIN).zip
	@rm -rf ~/.local/share/gnome-shell/extensions/$(NAME)@$(DOMAIN).zip
