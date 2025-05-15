import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext";
import PostalMime from 'postal-mime';
import { Octokit } from "octokit";
import * as cheerio from 'cheerio';

export default {
	async email(message, env, ctx) {
    try {
      const utf8ToBase64Modern = (str) => {
        let bytes = new TextEncoder().encode(str);
        let binary = String.fromCharCode(...bytes);
        return btoa(binary);
      }
			const string_to_slug = (str) => {
			    str = str.replace(/^\s+|\s+$/g, ''); // trim
			    str = str.toLowerCase();
			  
			    // remove accents, swap ñ for n, etc
			    var from = "àáäâèéëêìíïîòóöôùúüûñç·/_,:;";
			    var to   = "aaaaeeeeiiiioooouuuunc------";
			    for (var i=0, l=from.length ; i<l ; i++) {
			        str = str.replace(new RegExp(from.charAt(i), 'g'), to.charAt(i));
			    }

			    str = str.replace(/[^a-z0-9 -]/g, '') // remove invalid chars
			        .replace(/\s+/g, '-') // collapse whitespace and replace by -
			        .replace(/-+/g, '-'); // collapse dashes

			    return str;
			}

      const email = await PostalMime.parse(message.raw, { attachmentEncoding: 'base64' });

      const messageId = email.messageId.replace('<','').replace('>','').split('@')[0];
      const subjectSlug = string_to_slug(email.subject);

      const repo = {
        owner: `catskull`,
        repo: `blogs`,
        headers: {
          'X-GitHub-Api-Version': '2022-11-28'
        }
      };
      const octokit = new Octokit({
        auth: env.TOKEN
      });

      // get latest master commit sha so we can create a branch
      const { data: ref } = await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
        ...repo,
        ref: `heads/main`,
      });
      const latestMasterCommitSha = ref.object.sha;

      // create a branch based on latest master sha
      try {
        await octokit.rest.git.createRef({
          ...repo,
          ref: `refs/heads/${message.from}-${subjectSlug}`,
          sha: latestMasterCommitSha,
        });
      } catch {
        console.log('failed to create branch (already exists?)')
      }

      // get the body of the email, html or text
      let body = false;
      if (email.html) {
        const $ = cheerio.load(email.html);
        $('meta').remove();
        body = $('body').html();
      } else {
        // just wrap each line in a <p> tag and call it a day
        body = email.text.split('\n').map(s => `<p>${s}</p>`).join('\n').trim();
      }

      // 2025-05-08
      const dateStamp = new Date().toISOString().split('T')[0];
      
      let blogPostHtml = `---
subject: "${email.subject}"
---
${body}
`
      // commit each attachment, only dealing with inline images for now
      for (const attachment of email.attachments) {
        console.log(`committing ${attachment.filename}...`)
        const filepath = `assets/images/blogs/${message.from}/${dateStamp}/${subjectSlug}/${attachment.filename}`;

        await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}',
        {
          ...repo,
          path: filepath,
          message: `Create ${attachment.filename}`,
          content: attachment.content,
          branch: `${message.from}-${subjectSlug}`,
        });
        console.log('done.')

        // email images use a "cid" for the source, update to the URL
        if (email.html) {
          blogPostHtml = blogPostHtml.replace(`cid:${attachment.contentId.replace('<', '').replace('>', '')}`, `/${filepath}`);
        } else {
        // otherwise just add the images to a new tag
          blogPostHtml += `
<img src="${`https://blogs.catskull.net/${filepath}`}" alt="${attachment.filename}"/>
`
        }
      }

      const indexHtml = `---
layout: default
---
{% assign path_segments = page.url | split: '/' %}
{% assign user = path_segments[1] %}
{% include blog_index.html user=user %}

`;
      // create index.html, might fail if already exists and that's okay
      try {
	      await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}',
	      {
	        ...repo,
	        path: `_blogs/${message.from}/index.html`,
	        message: `Create index.html`,
	        content: utf8ToBase64Modern(indexHtml),
	        branch: `${message.from}-${subjectSlug}`,
	      });
	    } catch (e) {
	    	console.log('Failed creating index.html, already exists?');
	    	console.log(e.message);
	    }

      // commit html last since we update for each inline image
      await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}',
      {
        ...repo,
        path: `_blogs/${message.from}/${dateStamp}-${subjectSlug}.html`,
        message: `Create ${dateStamp}-${subjectSlug}.html`,
        content: utf8ToBase64Modern(blogPostHtml),
        branch: `${message.from}-${subjectSlug}`,
      });

      // create a pull request
      const { data: pr } = await octokit.rest.pulls.create({
        ...repo,
        title: `New blog post from ${message.from}`,
        head: `${message.from}-${subjectSlug}`,
        base: `main`,
        body: `Automatically created from a message from ${message.from} with subject: ${email.subject}`,
      });

      // squash and merge
      await octokit.rest.pulls.merge({
        ...repo,
        pull_number: pr.number,
        merge_method: 'squash',
        commit_title: `publish blog post for ${message.from}`,
        commit_message: `Processing email from ${message.from} with subject: ${email.subject}
Containing ${email.attachments ? email.attachments.length : 0} attachments.`,
      });

      // delete the branch
      await octokit.rest.git.deleteRef({
        ...repo,
        ref: `heads/${message.from}-${subjectSlug}`,
      });

			const replyBody = `
Message received.

-----------------
Beep boop.

I'm a bot.
Current status: 418
`
	    const msg = createMimeMessage();
	    msg.setHeader("In-Reply-To", message.headers.get("Message-ID"));
	    msg.setSender({ name: "Blog Bot 🤖", addr: "blog-auto-responder@catskull.net" });
	    msg.setRecipient(message.from);
	    msg.setSubject("blog post published");
	    msg.addMessage({
	      contentType: 'text/plain',
	      data: replyBody,
	    });

	    const replyMessage = new EmailMessage(
	      "blog-auto-responder@catskull.net",
	      message.from,
	      msg.asRaw()
	    );

	    await message.reply(replyMessage);
    } catch (e) {
      console.log('Something fricked up')
      console.log(e)
    }
	},
};
