import { Hono } from 'hono';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { cors } from 'hono/cors';

const app = new Hono();
app.use(cors());

interface Job {
  title: string;
  teaser: string;
  released?: string;
  deadline?: string;
  link: string | undefined;
  company: string | undefined;
  image_url: string;
  locations: string[];
  scraped_from?: string;
}

// Cache object to store jobs and timestamp
const cache = {
  data: [] as Job[],
  timestamp: 0,
  cacheDuration: 60 * 60 * 1000 // Cache duration set to 1 hour
};

const scrapeIdaJobbank = async (): Promise<Job[]> => {
  //TODO: Udvid til at scrape flere pages fra Ida
  const response = await axios.get('https://www.jobfinder.dk/jobs/jobtype/praktikplads/jobtype/studiejob/category/it/category/softwareudvikling');
  const selector = cheerio.load(response.data);

  const jobs: Job[] = [];
  selector('.node-list__item').each((index, element) => {
    const jobElement = selector(element);
    const titleElement = jobElement.find('.node-list__item-title--link').first();
    const teaserElement = jobElement.find('.node-list__item-description').first();
    const linkElement = jobElement.find('.node-list__item-title--link').first();
    const companyElement = jobElement.find('.node-list__item-recruiter').first();
    const imageElement = jobElement.find('.node-list__item-logo').find('img').first();
    const locationElement = jobElement.find('.node-list__item-location').first();
    const location = locationElement.text().replace('location_on', '');
    

    let title = titleElement.text();
    let teaser = teaserElement.text();
    let link = linkElement.attr('href');
    let company = companyElement.text().replace("business", "").trim();

    let image = imageElement.attr('src');
  

    if (!image) {
      image = 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Error.svg/1200px-Error.svg.png';
    }

    if (link && !link.startsWith('http')) {
      link = `https://www.jobfinder.dk${link}`;
    }

    let locations: string[] = [];
    location.split('/').forEach(loc => {
      locations.push(loc.trim());
    });

    title = title.replace(/\t/g, '').trim();
    teaser = teaser.replace(/\t/g, '').trim();

    const job: Job = { title, teaser, link, scraped_from: 'Ida job bank', company, image_url: image, locations: locations};
    jobs.push(job);
  });

  return jobs;
}

const scrapeStudereneOnline = async (): Promise<Job[]> => {
  const response = await axios.get('https://studerendeonline.dk/job/?cvtype=4&max=100&branche=10331');
  const selector = cheerio.load(response.data);

  const jobs: Job[] = [];
  selector('.job-item').each((index, element) => {
    const jobElement = selector(element);
    const titleElement = jobElement.find('.job-header').first();
    const teaserElement = jobElement.find('.job-teaser').first();
    const releasedElement = jobElement.find('.job-date-updated').first();
    const deadlineElement = jobElement.find('.job-date-application').first();
    const linkElement = jobElement.find('a').first();
    const companyElement = jobElement.find('.job-logo-small').find('img').first();

    

    let title = titleElement.text();
    let teaser = teaserElement.text();
    let released = releasedElement.text().replace('Opdateret: ', '').trim();
    let deadline = deadlineElement.text().trim();
    let link = linkElement.attr('href');
    let image = companyElement.attr('data-original');
    let company = companyElement.attr('alt')?.replace(" - logo", "").trim();;

    if (link && !link.startsWith('http')) {
      link = `https://studerendeonline.dk${link}`;
    }

    if (image && !image.startsWith('http')) {
      image = `https://studerendeonline.dk${image}`;
    }

    if (!image) {
      image = 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Error.svg/1200px-Error.svg.png';
    }

    title = title.replace(/\t/g, '').trim();
    teaser = teaser.replace(/\t/g, '').trim();

    let locations: string[] = [];

    const teaserSplitToWords = teaser.split(' ');
    if (company) {
      const companySplitToWords = company.split(' ');
      const indexOfCompanyName = teaserSplitToWords.indexOf(companySplitToWords[companySplitToWords.length - 1] + ',')
      locations = teaserSplitToWords.slice(indexOfCompanyName + 1, teaserSplitToWords.length + 1);
      locations = locations.map(loc => loc.replace(',', '').trim());
    }
    const job: Job = { title, teaser: "Studiejob hos " + company, released, deadline, link, scraped_from: 'Studerende Online', company, image_url: image, locations: locations};
    jobs.push(job);

  });

  return jobs;
};

app.get('/', async (c) => {
  try {
    const now = Date.now();
    if (cache.data.length > 0 && (now - cache.timestamp < cache.cacheDuration)) {
      // Return cached data if it's still valid 
      return c.json({ jobs: cache.data });
    }
    // else we fetch a new one
    const studerendeonline = await scrapeStudereneOnline();
    const idajobbank = await scrapeIdaJobbank();
    console.log("Studerende længde", studerendeonline.length);
    console.log("Ida jobbank længde", idajobbank.length);
    let jobtitles = [...studerendeonline, ...idajobbank];

    // Parse dates and sort jobs by release date, placing those without a release date at the bottom
    jobtitles.sort((a, b) => {
      if (!a.released) return 1;
      if (!b.released) return -1;

      const dateA = new Date(a.released.split('.').reverse().join('-')).getTime();
      const dateB = new Date(b.released.split('.').reverse().join('-')).getTime();
      return dateB - dateA;
    });

    console.log("Fetched new data!");
    console.log(jobtitles.length);

    // Update the cache
    cache.data = jobtitles;
    cache.timestamp = now;

    return c.json({ jobs: jobtitles });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

export default app;
