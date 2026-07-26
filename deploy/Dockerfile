ARG WEB_SERVER_IMAGE
FROM ${WEB_SERVER_IMAGE}

# Need to serve at /api-keys/
ENV BASE_PATH=/api-keys
COPY dist/ /app/public/api-keys/

EXPOSE 8080
