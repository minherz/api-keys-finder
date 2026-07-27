# 0. Base image URI should be set explicitly
ARG WEB_SERVER_IMAGE
FROM ${WEB_SERVER_IMAGE}

# 1. Physical location on disk for files
ENV STATIC_DIR=/app/public

# 2. Virtual prefix to strip from incoming URLs
ENV BASE_PATH=/api-keys

# Copy built files directly into the root static directory
COPY dist/ /app/public/

EXPOSE 8080
