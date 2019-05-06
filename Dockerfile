FROM node:8.14.0-alpine as basis

WORKDIR /opt/iotagent

RUN apk add git python make bash gcc g++ zeromq-dev musl-dev zlib-dev krb5-dev --no-cache

COPY package.json .
COPY package-lock.json .

RUN npm install
COPY . .

FROM node:8.14.0-alpine
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]

COPY --from=basis  /opt/iotagent /opt/iotagent
WORKDIR /opt/iotagent


EXPOSE 1883
CMD ["node", "index.js"]
