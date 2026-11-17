# One image: the ASP.NET Core API also serves the built React app from wwwroot.

FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY web/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api
WORKDIR /src
COPY api/Api.csproj ./
RUN dotnet restore
COPY api/ ./
RUN dotnet publish -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=api /app ./
COPY --from=web /web/dist ./wwwroot
# Contact messages live in SQLite on a volume. The image runs as the non-root "app" user, so it has to own /data.
RUN mkdir /data && chown $APP_UID /data
ENV DB_PATH=/data/portfolio.db
VOLUME /data
USER $APP_UID
EXPOSE 8080
ENTRYPOINT ["dotnet", "Api.dll"]
