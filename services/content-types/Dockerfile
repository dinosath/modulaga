FROM rust:1.99-bookworm AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends protobuf-compiler pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY services/content-types/Cargo.toml services/content-types/Cargo.lock /app/services/content-types/
COPY services/content-types/build.rs /app/services/content-types/build.rs
COPY services/content-types/proto /app/services/content-types/proto
COPY services/content-types/src /app/services/content-types/src
COPY services/workspace-config/Cargo.toml services/workspace-config/Cargo.lock /app/services/workspace-config/
COPY services/workspace-config/build.rs /app/services/workspace-config/build.rs
COPY services/workspace-config/proto /app/services/workspace-config/proto
COPY services/workspace-config/src /app/services/workspace-config/src
COPY workspace-config /app/workspace-config
RUN cargo build --manifest-path services/content-types/Cargo.toml --release --bin content-types

FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* && useradd --system --no-create-home --uid 10001 modulaga && mkdir -p /app/data && chown modulaga:modulaga /app/data
COPY --from=builder /app/services/content-types/target/release/content-types /usr/local/bin/content-types
USER modulaga
EXPOSE 4305
CMD ["/usr/local/bin/content-types"]
