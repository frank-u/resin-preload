#!/bin/bash

SCRIPT=$(basename ${BASH_SOURCE[0]})
DIRNAME=$(realpath $(dirname ${BASH_SOURCE[0]}))
CONTAINER_NAME="resin-image-preloader"

function cleanup() {
    docker rm $CONTAINER_NAME || true
}

trap cleanup EXIT

function usage() {
    echo ""
    echo "Usage: $SCRIPT [options]"
    echo ""
    echo "Options:"
    echo ""
    echo "  --app          Application ID (required)"
    echo "  --img          Disk image to preload into (required)"
    echo "  --api-key      API key"
    echo "  --api-token    API token"
    echo "  --api-host     API hostname"
    echo "  --registry     Image registry host"
    echo ""
    echo "Example:"
    echo ""
    echo "  $SCRIPT --app 123456 --api-token \"xxxx...\" --img /path/to/resin-os.img"
    echo ""
}

function set_options() {
    local options="$@"
    local argv=($options)
    local index=0
    
    for opt in $options; do
        index=$(($index + 1))
        case $opt in
            --help)
                usage
                exit 0
                ;;
            --app) APP_ID=${argv[$index]} ;;
            --img) IMAGE=${argv[$index]} ;;
            --api-token) API_TOKEN=${argv[$index]} ;;
            --api-key) API_KEY=${argv[$index]} ;;
            --api-host) API_HOST=${argv[$index]} ;;
            --registry) REGISTRY_HOST=${argv[$index]} ;;
        esac
    done
}

set_options $@

# Build the preloader image
docker build -t resin/resin-preload $DIRNAME
# Run the preloader
docker run -it --privileged \
    -e API_TOKEN=$API_TOKEN \
    -e APP_ID=$APP_ID \
    -e REGISTRY_HOST=$REGISTRY_HOST \
    -e API_HOST=$API_HOST \
    -v $IMAGE:/img/resin.img \
    --name $CONTAINER_NAME \
    resin/resin-preload
