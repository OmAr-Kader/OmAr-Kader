const { Octokit } = require("@octokit/rest");
const fs = require("fs");

const octokit = new Octokit({
    auth: process.env.GH_TOKEN
});

const username = process.env.GH_USERNAME;


async function main() {

    let repos = [];

    for await (const response of octokit.paginate.iterator(
        octokit.rest.repos.listForAuthenticatedUser,
        {
            visibility: "all",
            affiliation: "owner",
            per_page: 100
        }
    )) {
        repos.push(...response.data);
    }


    const total = repos.length;

    const privateRepos =
        repos.filter(repo => repo.private).length;

    const publicRepos =
        repos.filter(repo => !repo.private).length;


    const stars =
        repos.reduce(
            (sum, repo) =>
                sum + repo.stargazers_count,
            0
        );


    const forks =
        repos.reduce(
            (sum, repo) =>
                sum + repo.forks_count,
            0
        );


    const svg = `
<svg width="500" height="220"
     xmlns="http://www.w3.org/2000/svg">

<rect width="100%" height="100%"
      rx="15"
      fill="#0d1117"/>


<text x="30"
      y="50"
      fill="white"
      font-size="24"
      font-family="Arial">
      GitHub Statistics
</text>


<text x="30"
      y="95"
      fill="#58a6ff"
      font-size="18"
      font-family="Arial">
      Total Repositories: ${total}
</text>


<text x="30"
      y="125"
      fill="#3fb950"
      font-size="18"
      font-family="Arial">
      Public: ${publicRepos}
</text>


<text x="30"
      y="155"
      fill="#f85149"
      font-size="18"
      font-family="Arial">
      Private: ${privateRepos}
</text>


<text x="30"
      y="185"
      fill="#d29922"
      font-size="18"
      font-family="Arial">
      ⭐ Stars: ${stars}   🍴 Forks: ${forks}
</text>


</svg>
`;


    fs.writeFileSync(
        "github-stats.svg",
        svg.trim()
    );


    console.log("Generated stats:");
    console.log({
        total,
        publicRepos,
        privateRepos,
        stars,
        forks
    });
}


main();
