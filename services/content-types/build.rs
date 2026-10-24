fn main() {
    connectrpc_build::Config::new()
        .files(&["proto/content_types.proto"])
        .includes(&["proto"])
        .include_file("_connectrpc.rs")
        .compile()
        .expect("compile content types protobuf");
}
