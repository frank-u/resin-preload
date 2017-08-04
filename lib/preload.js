'use strict'

const path = require('path')
const Docker = require('dockerode')
const tarfs = require('tar-fs')
const streamModule = require('stream')
const Promise = require('bluebird')

const preload = module.exports

const docker = new Docker({Promise: Promise})

const DOCKER_IMAGE_TAG = 'resin/resin-preload'
const DISK_IMAGE_PATH_IN_DOCKER = '/img/resin.img'
const SPLASH_IMAGE_PATH_IN_DOCKER = '/img/resin-logo.png'

/** @const {String} Default container name */
preload.CONTAINER_NAME = 'resin-image-preloader'

/**
 * Build the preloader docker image
 * @returns Promise
 */
preload.build = function () {
  console.log('Building preloader image...')
  return docker.buildImage(
    tarfs.pack(path.resolve(__dirname, '..')),
    {t: DOCKER_IMAGE_TAG}
  )
  .then((stream) => {
    return new Promise((resolve, reject) => {
      docker.modem.followProgress(
        stream,
        (err, output) => {
          if (err) {
            reject(err)
            return
          }
          resolve()
        },
        (event) => {
          if (event.stream) {
            process.stdout.write(event.stream)
          }
        }
      )
    })
  })
}

class DevNull extends streamModule.Writable {
  _write (chunk, enc, next) {
    next()
  }
}

class BufferBackedWritableStream extends streamModule.Writable {
  constructor () {
    super(arguments)
    this.chunks = []
  }

  _write (chunk, enc, next) {
    this.chunks.push(chunk)
    next()
  }

  getData () {
    return Buffer.concat(this.chunks)
  }
}

const bindMount = (source, target) => {
  return {
    Source: path.resolve(source),
    Target: target,
    Type: 'bind',
    Consistency: 'delegated'
  }
}

const createContainerDisposer = (options) => {
  const mounts = [bindMount(options.image, DISK_IMAGE_PATH_IN_DOCKER)]
  if (options.splashImage) {
    mounts.push(bindMount(options.splashImage, SPLASH_IMAGE_PATH_IN_DOCKER))
  }
  return docker.createContainer({
    Image: DOCKER_IMAGE_TAG,
    Name: options.containerName || preload.CONTAINER_NAME,
    NetworkMode: 'host',
    Privileged: true,
    AttachStdout: true,
    AttachStderr: true,
    Env: [
      `COMMAND=${options.command}`,
      `APP_ID=${options.appId}`,
      `API_TOKEN=${options.apiToken || ''}`,
      `API_KEY=${options.apiKey || ''}`,
      `COMMIT=${options.commit || ''}`,
      `REGISTRY_HOST=${options.registryHost || ''}`,
      `API_HOST=${options.apiHost || ''}`,
      `DONT_DETECT_FLASHER_TYPE_IMAGES=${options.dontDetectFlasherTypeImages ? 'TRUE' : 'FALSE'}`
    ],
    Mounts: mounts
  })
  .disposer((container) => {
    return container.remove()
  })
}

const runContainer = (container) => {
  return container.start()
  .then((container) => {
    return container.attach({stream: true, stdout: true, stderr: true})
  })
  .then((stream) => {
    docker.modem.demuxStream(stream, process.stdout, process.stderr)
    return new Promise((resolve, reject) => {
      stream.on('end', resolve)
      stream.on('error', reject)
    })
  })
}

/**
 * Preload a given image
 * @param {Object} options - Image options
 * @param {String|Number} options.appId - Application ID
 * @param {String} options.image - Path to image to preload
 * @param {String} [options.apiToken] - Resin.io API token
 * @param {String} [options.apiKey] - Resin.io API token
 * @param {String} [options.commit] - Application commit to preload
 * @param {String} [options.apiHost] - Resin.io API host
 * @param {String} [options.registry] - Docker registry host
 * @param {String} [options.containerName] - Docker container name
 * @returns {ChildProcess}
 */
preload.run = function (options) {
  options.command = 'preload'
  return Promise.using(createContainerDisposer(options), runContainer)
}

preload.getDeviceTypeSlug = function (options) {
  options.command = 'get_device_type_slug'
  return Promise.using(createContainerDisposer(options), (container) => {
    return container.start()
    .then((container) => {
      return container.attach({stream: true, stdout: true})
    })
    .then((stream) => {
      const out = new BufferBackedWritableStream()
      docker.modem.demuxStream(stream, out, new DevNull())
      return new Promise((resolve, reject) => {
        stream.on('error', reject)
        stream.on('end', () => {
          resolve(out.getData().toString('utf8').slice(0, -1))
        })
      })
    })
  })
}

preload.capitano = function () {
  return require('./capitano')
}
