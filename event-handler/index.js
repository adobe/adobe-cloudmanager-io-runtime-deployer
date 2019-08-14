/*
Copyright 2019 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/

const fetch = require('node-fetch')
const jsrsasign = require('jsrsasign')
const openwhisk = require('openwhisk')

require('dotenv').config()

async function getAccessToken () {
  const EXPIRATION = 60 * 60 // 1 hour

  const header = {
    alg: 'RS256',
    typ: 'JWT'
  }

  const payload = {
    exp: Math.round(new Date().getTime() / 1000) + EXPIRATION,
    iss: process.env.ORGANIZATION_ID,
    sub: process.env.TECHNICAL_ACCOUNT_ID,
    aud: `https://ims-na1.adobelogin.com/c/${process.env.API_KEY}`,
    'https://ims-na1.adobelogin.com/s/ent_cloudmgr_sdk': true
  }

  const jwtToken = jsrsasign.jws.JWS.sign('RS256', JSON.stringify(header), JSON.stringify(payload), process.env.PRIVATE_KEY)

  const response = await fetch('https://ims-na1.adobelogin.com/ims/exchange/jwt', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: process.env.API_KEY,
      client_secret: process.env.CLIENT_SECRET,
      jwt_token: jwtToken
    })
  })

  const json = await response.json()

  return json['access_token']
}

async function makeApiCallWithoutResponseBody (accessToken, url, method, body) {
  const options = {
    method: method,
    headers: {
      'x-gw-ims-org-id': process.env.ORGANIZATION_ID,
      'x-api-key': process.env.API_KEY,
      Authorization: `Bearer ${accessToken}`
    }
  }
  if (body) {
    options.body = JSON.stringify(body)
    options.headers['content-type'] = 'application/json'
  }
  return await fetch(url, options)
}

async function makeApiCall (accessToken, url, method, body) {
  const response = await makeApiCallWithoutResponseBody(accessToken, url, method, body)

  return response.json()
}

function getLink (obj, linkType) {
  return obj['_links'][linkType].href
}

async function getStepState (accessToken, stepStateUrl) {
  const stepState = await makeApiCall(accessToken, stepStateUrl, 'GET')

  const execution = await makeApiCall(accessToken, new URL(getLink(stepState, 'http://ns.adobe.com/adobecloud/rel/execution'), stepStateUrl), 'GET')
  stepState.execution = execution

  const program = await makeApiCall(accessToken, new URL(getLink(stepState, 'http://ns.adobe.com/adobecloud/rel/program'), stepStateUrl), 'GET')
  stepState.program = program

  return stepState
}

async function advance (accessToken, stepState, stepStateUrl) {
  const advanceLink = new URL(getLink(stepState, 'http://ns.adobe.com/adobecloud/rel/pipeline/advance'), stepStateUrl)
  return makeApiCallWithoutResponseBody(accessToken, advanceLink, 'PUT', { approved: true })
}

async function cancel (accessToken, stepState, stepStateUrl) {
  const rejectLink = new URL(getLink(stepState, 'http://ns.adobe.com/adobecloud/rel/pipeline/cancel'), stepStateUrl)
  return makeApiCallWithoutResponseBody(accessToken, rejectLink, 'PUT', { approved: false })
}

function handleStepStartEvent (objectUrl) {
  const ow = openwhisk()

  return new Promise((resolve, reject) => {
    console.log('received step start event')

    getAccessToken().then(accessToken => {
      getStepState(accessToken, objectUrl).then(stepState => {
        console.log(`event was for program ${stepState.program.id} with action ${stepState.action}`)
        if (stepState.program.id === process.env.PROGRAM_ID) {
          if (stepState.action === 'deploy') {
            if (stepState.environmentType === 'dev') {
              const buildStep = stepState.execution._embedded.stepStates.find(ss => ss.action === 'build')
              if (buildStep) {
                console.log(`build ${buildStep.branch} as dev`)
                ow.actions.invoke({
                  name: 'cmruntime/deploy-to-runtime',
                  params: {
                    ref: buildStep.branch,
                    version: 'dev'
                  }
                }).then(resolve).catch(reject)
              } else {
                const err = `Could not find build step for execution ${JSON.stringify(stepState)}`
                console.log(err)
                reject(err)
              }
            } else if (stepState.environmentType === 'stage') {
              console.log(`build ${stepState.execution.artifactsVersion}`)
              ow.actions.invoke({
                name: 'cmruntime/deploy-to-runtime',
                params: {
                  ref: stepState.execution.artifactsVersion,
                  version: stepState.execution.artifactsVersion
                }
              }).then(resolve).catch(reject)
            }
          }
        }
        resolve()
      })
    })
  })
}

function handleWaiting (objectUrl) {
  const ow = openwhisk()

  return new Promise((resolve, reject) => {
    console.log('received step waiting event')

    getAccessToken().then(accessToken => {
      getStepState(accessToken, objectUrl).then(stepState => {
        if (stepState.program.id === process.env.PROGRAM_ID) {
          if (stepState.action === 'approval') {
            ow.actions.invoke({
              name: 'cmruntime/deploy-to-runtime',
              params: {
                ref: stepState.execution.artifactsVersion,
                version: stepState.execution.artifactsVersion,
                check: true
              },
              blocking: true,
              result: true
            }).then((response) => {
              if (response.result) {
                console.log('All actions were deployed with the excepted versions. Approving')
                advance(accessToken, stepState, objectUrl).then(resolve).catch(reject)
              } else {
                console.log('Not all actions were deployed with the expected versions')
                console.log(response)
                cancel(accessToken, stepState, objectUrl).then(resolve).catch(reject)
              }
            }).catch(reject)
            return
          }
          resolve()
        }
      })
    })
  })
}

function main (params) {
  const STARTED = 'https://ns.adobe.com/experience/cloudmanager/event/started'
  const WAITING = 'https://ns.adobe.com/experience/cloudmanager/event/waiting'
  const STEP_STATE = 'https://ns.adobe.com/experience/cloudmanager/execution-step-state'

  const event = params.event
  const objectUrl = event['activitystreams:object']['@id']

  if (STEP_STATE === event['xdmEventEnvelope:objectType']) {
    if (STARTED === event['@type']) {
      return handleStepStartEvent(objectUrl)
    } else if (WAITING === event['@type']) {
      return handleWaiting(objectUrl)
    }
  }
}

exports.main = main
