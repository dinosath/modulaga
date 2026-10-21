FROM rust:1.99-bookworm AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends protobuf-compiler pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY services/workspace-config/Cargo.toml services/workspace-config/Cargo.lock /app/services/workspace-config/
COPY services/workspace-config/build.rs /app/services/workspace-config/build.rs
COPY services/workspace-config/proto /app/services/workspace-config/proto
COPY services/workspace-config/src /app/services/workspace-config/src
COPY workspace-config /app/workspace-config
RUN cargo build --manifest-path services/workspace-config/Cargo.toml --release --bins

FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* && useradd --system --no-create-home --uid 10001 modulaga && mkdir -p /app/data && chown modulaga:modulaga /app/data
COPY --from=builder /app/services/workspace-config/target/release/workspace-config /usr/local/bin/workspace-config
COPY --from=builder /app/services/workspace-config/target/release/app-catalog /usr/local/bin/app-catalog
USER modulaga
EXPOSE 4303
CMD ["/usr/local/bin/workspace-config"]
