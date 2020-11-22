FROM node:lts-buster
COPY wait-for-it.sh /wait-for-it.sh
RUN chmod +x /wait-for-it.sh
RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app
COPY --chown=node:node ./app/ /home/node/app
WORKDIR /home/node/app
USER node
RUN npm install
CMD node main.js