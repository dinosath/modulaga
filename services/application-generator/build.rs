fn main() {
    connectrpc_build::Config::new()
        .files(&["proto/application_generator.proto"])
        .includes(&["proto"])
        .include_file("_connectrpc.rs")
        .compile()
        .expect("compile application generator protobuf");
}
