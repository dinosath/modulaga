fn main() {
    connectrpc_build::Config::new()
        .files(&["proto/workspace_config.proto", "proto/catalog.proto"])
        .includes(&["proto"])
        .include_file("_connectrpc.rs")
        .compile()
        .expect("compile workspace configuration protobufs");
}
