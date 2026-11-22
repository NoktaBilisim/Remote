module remote-support/agent-win/test/spike-p33

go 1.26.0

toolchain go1.26.11

require (
	github.com/ebitengine/purego v0.11.3
	github.com/tetratelabs/wazero v1.12.0
	remote-support/agent-win v0.0.0
)

require golang.org/x/sys v0.50.0 // indirect

replace remote-support/agent-win => ../..
