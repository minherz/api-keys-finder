FROM nginx:alpine

# Copy the app's Nginx configuration
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built files into the application subdirectory to ensure it maps correctly from Firebase
COPY dist/ /usr/share/nginx/html/api-keys/

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
