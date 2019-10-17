const axios = require('axios')
const { stripIndents } = require('common-tags')
const core = require('@actions/core')
const github = require('@actions/github')
const { execSync } = require('child_process')
const exec = require('@actions/exec')

const context = github.context

const zeitToken = core.getInput('zeit-token')
const zeitTeamId = core.getInput('zeit-team-id')
const nowArgs = core.getInput('now-agrs')
const githubToken = core.getInput('github-token')
const githubDeployment = core.getInput('github-deployment')

const zeitAPIClient = axios.create({
  baseURL: 'https://api.zeit.co', headers: {
    Authorization: `Bearer ${zeitToken}`,
  }, params: {
    teamId: zeitTeamId || undefined,
  },
})

const octokit = new github.GitHub(githubToken)

async function run () {
  await nowDeploy()
  if (context.issue.number) {
    core.info('this is related issue or pull_request ')
    await createComment()
  }
}

async function nowDeploy () {
  const commit = execSync('git log -1 --pretty=format:%B').toString().trim()

  let myOutput = ''
  let myError = ''
  const options = {}
  options.listeners = {
    stdout: (data) => {
      myOutput += data.toString()
      core.info(data.toString())
    }, stderr: (data) => {
      myError += data.toString()
      core.info(data.toString())
    },
  }

  return await exec.exec('npx', [
    `now ${nowArgs}`.trim(),
    '-t',
    zeitToken,
    '-m',
    `githubCommitSha=${context.sha}`,
    '-m',
    `githubCommitAuthorName=amond`,
    '-m',
    'githubCommitAuthorLogin=amondnet',
    '-m',
    'githubDeployment=1',
    '-m',
    `githubOrg=${context.repo.owner}`,
    '-m',
    `githubRepo=${context.repo.repo}`,
    '-m',
    `githubCommitOrg=${context.repo.owner}`,
    '-m',
    `githubCommitRepo=${context.repo.repo}`,
    '-m',
    `githubCommitMessage=${commit}`], options).then(() => {
  })
}

async function createComment () {

  const {
    data: comments,
  } = await octokit.issues.listComments({
    ...context.repo, issue_number: context.issue.number,
  })
  console.log(comments)

  const zeitPreviewURLComment = comments.find(
    comment => comment.body.startsWith('Deploy preview for _website_ ready!'))

  let deploymentUrl
  let deploymentCommit

  const {
    data: {
      deployments: [commitDeployment],
    },
  } = await zeitAPIClient.get('/v4/now/deployments', {
    params: {
      'meta-githubCommitSha': context.sha,
    },
  })

  if (commitDeployment) {
    deploymentUrl = commitDeployment.url
    deploymentCommit = commitDeployment.meta.commit
  } else {
    const {
      data: {
        deployments: [lastBranchDeployment],
      },
    } = await zeitAPIClient.get('/v4/now/deployments', {
      params: {
        'meta-githubCommitRef': context.ref,
      },
    })

    if (lastBranchDeployment) {
      deploymentUrl = lastBranchDeployment.url
      deploymentCommit = lastBranchDeployment.meta.commit
    } else {
      const {
        data: {
          deployments: [lastDeployment],
        },
      } = await zeitAPIClient.get('/v4/now/deployments', {
        params: {
          limit: 1,
        },
      })

      if (lastDeployment) {
        deploymentUrl = lastDeployment.url
        deploymentCommit = lastDeployment.meta.commit
      }
    }
  }

  const commentBody = stripIndents`
    Deploy preview for _website_ ready!

    Built with commit ${deploymentCommit}

    https://${deploymentUrl}
  `

  if (zeitPreviewURLComment) {
    await octokit.issues.updateComment({
      ...context.repo, comment_id: zeitPreviewURLComment.id, body: commentBody,
    })
  } else {
    await octokit.issues.createComment({
      ...context.repo, issue_number: context.issue.number, body: commentBody,
    })
  }

  core.setOutput('preview-url', `https://${deploymentUrl}`)
}

run().catch(error => {
  core.setFailed(error.message)
})

