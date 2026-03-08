FROM rust:1-bookworm
WORKDIR /app

COPY . ./
RUN cargo build --release

ENV GATEWAY_BIND=0.0.0.0:8080
ENV RUST_LOG=info
EXPOSE 8080

CMD ["/app/target/release/pulsemesh-gateway"]
