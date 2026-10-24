FROM rust:1-bookworm
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/* \
    && cargo install --git https://github.com/aliev/baker --locked
COPY services/workspace-config /workspace-config
COPY services/application-generator /application-generator
WORKDIR /application-generator
ENV CARGO_TARGET_DIR=/app/target
RUN cargo build --release --bin application-generator
ENV AUTH_MODE=disabled \
    APPLICATION_GENERATOR_DATABASE_URL=sqlite:///app/data/application-generator.sqlite?mode=rwc \
    CONTENT_TYPES_API_URL=http://content-types:4305 \
    GENERATED_APPS_DIR=/app/generated
EXPOSE 4306
CMD ["/app/target/release/application-generator"]
